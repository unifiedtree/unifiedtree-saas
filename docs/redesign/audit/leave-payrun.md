# Phase 0 audit: Leave operations + Payroll run

Area owner: this report. Read-only audit of `main` at `e32a4dc6` (C:\REACT\unifiedtree-saas).
Design sources: `design_handoff_hrms_redesign/prototype/PgLeave.dc.html`, `PgPayroll.dc.html`, plus the tabs of the same two pages that the prototype renders through `PgTime.dc.html` (page `l-ops`) and `PgPay.dc.html` (page `py-runs`). Nav model: `hrms-core.js` (`M.leave`, `M.payroll`, `VIEW`, `VTAB`, `vals()`).

## 0. How this audit was done, and what could not be checked

- Everything below comes from reading code: the prototype files, the React app, the Spring backend and the Flyway migrations in `backend/app/hrms-app/src/main/resources/db/canonical`.
- **No live checks were possible.** The API at `http://127.0.0.1:8080/api` was not running (connection refused). The recovery database port 55432 refused connections. The Postgres on 5432 uses a different password, so I did not try it further.
- No payroll run was created, processed, locked or paid. No file in the repo was changed.

### Which prototype file draws which tab

`hrms-core.js` routes pages to views like this:
- `view = … ((cur[0]==='a-daily' || cur[0]==='l-ops') && tab > 0) ? 'time' : … (cur[0]==='py-runs' && tab !== 1) ? 'paypg' …`
- `VTAB = { 'l-ops': 0, 'py-runs': 1 }`

| Page (nav model) | Tab | Drawn by |
|---|---|---|
| Leave › Leave operations (`l-ops`) | 0 Approvals | `PgLeave.dc.html` (the whole file) |
| | 1 Decided · 2 Balances · 3 Calendar · 4 Encash · 5 Year end · 6 Leave types · 7 Holidays | `PgTime.dc.html`, `P['l-ops'].tabs[1..7]`, rendered by `UtSections` / `UtSection` |
| Payroll › Processing & payslips (`py-runs`) | 0 All runs | `PgPay.dc.html`, `P['py-runs'].tabs[0]` |
| | 1 Overview | `PgPayroll.dc.html` (the whole file) |
| | 2 Employees (+ payslip view `V.slip`) | `PgPay.dc.html`, `P['py-runs'].tabs[2]` and `V.slip` |
| | 3 Skipped | `PgPay.dc.html`, `P['py-runs'].tabs[3]` |

In PgTime, tabs 1–7 of `l-ops` share one header: crumb "Leave", title "Leave operations center", and a primary button "Apply for someone". PgLeave (tab 0) has its own header: eyebrow "Leave · Operations", title "Leave requests", a headline line, and the buttons Leave calendar, Policies and **Apply on behalf**.

### Status markers used below

- **exists**: an endpoint or hook already provides it and the page can show it as-is.
- **partial**: some of it is there. The note says what is missing.
- **missing**: nothing provides it today.

---

## A. Leave operations (`/hrms/leave`)

### A.0 Page, route, navigation and permissions today

**Route.** `App.tsx`:

```tsx
<Route path="/hrms/leave" element={<RouteGuard anyOf={[P.HRMS_LEAVE_READ, P.HRMS_ESS_READ, P.LEAVE_REQUEST_SELF]}><ModuleGate moduleKey="hrms"><Leave /></ModuleGate></RouteGuard>} />
```

**Files.**
- Page: `apps/platform/src/modules/hrms/Leave.tsx`.
- Tab contents: `leave/LeaveCalendar.tsx` + `leave/useLeaveCalendar.ts`, `leave/LeaveEncashment.tsx`, `leave/LeaveYearEnd.tsx`, `leave/LeaveTypes.tsx`, `leave/HolidayCalendar.tsx`.
- Hooks: `modules/hrms/api/useLeave.ts`, `useLeaveYearEnd.ts`, `useWfh.ts`, `useSettings.ts` (holidays and weekend days), `useOrg.ts` (companies).
- Kit: `design/module/ModuleKit.tsx` (ModulePage, Views, useView, StatRow, ApprovalList, RowList/Row, Panel, Note, Facts, State, useDesignToast).

**Page exists: yes.** It is one page with view tabs kept in `?tab=`. Tab keys today are `my`, `apply`, `balances`, `approvals`, `history`, `encash`, `yearend`, `calendar`, `types` and `holidays`.

**Rail and menu.**
- `PlatformShell.tsx` MODULE_ITEMS has group `leave` → "Leave Operations Center" `/hrms/leave`.
- Visibility is permission-only through `menuRule('/hrms/leave','leave')`. From `pageRegistry.ts` `MENU_RULES`:

  ```ts
  'leave:/hrms/leave': [{ anyOf: ['hrms.leave.approve.l1', 'settings.holidays.write', 'leave.type.write', 'hrms.report.leave'], module: HR }]
  ```

- Employees reach the same route as the "Leave" tab of the ESS group:

  ```ts
  'ess:/hrms/leave': [{ ...any('leave.request.self'), module: HR, self: true }]
  ```

  The whole `ess` group is hidden from admin roles (`isVisible`: `if (group === 'ess' && administersWorkspace) return false`).

**Tab gating today.** `Leave.tsx` sets it up as follows. The same rules are mirrored in `pageRegistry.ts` `tab('leave', …)`, and each tab rule is added to the page rule `any('hrms.leave.read','hrms.ess.read','leave.request.self')`.

| Tab key | Label | Shown when (today) |
|---|---|---|
| my, apply, balances | My leave, Apply, Balances (your own) | `!isAdmin` (`useRoles`: OWNER, SUPER_ADMIN, COMPANY_ADMIN, ADMIN). Registry: `allOf: ['leave.request.self'], when: notAdminRole` |
| approvals | Approvals (count badge = pending leave + pending WFH) | `usePermission(P.HRMS_LEAVE_APPROVE_L1)`. The WFH part needs `P.WFH_APPROVE` |
| history | Decided | `usePermission(P.HRMS_LEAVE_APPROVE_L1)` |
| encash | Encash (badge = pending encashments) | `(usePermission('leave.request.self') && !isAdmin) \|\| usePermission('hrms.leave.encash.approve')` |
| yearend | Year end | `usePermission('hrms.leave.yearend.run')` |
| calendar, types, holidays | Calendar, Leave types, Holidays | everyone on the page. Editing is gated inside (`leave.type.write`, `settings.holidays.write`) |

**Design tabs and how they map to today's keys.**

| Design tab (`M.leave` page `l-ops`) | Today's key | Match |
|---|---|---|
| Approvals | `approvals` | same |
| Decided | `history` | same data. Keep the key (`/hrms/leave?tab=history` is linked) |
| Balances | — | **conflict.** Design = everyone's balances (HR view). Today's `balances` = your own balances. Needs a new key (see D.1) |
| Calendar | `calendar` | same |
| Encash | `encash` | same (the HR half) |
| Year end | `yearend` | same |
| Leave types | `types` | same |
| Holidays | `holidays` | same |
| — (not in this design) | `my`, `apply`, `balances` (self) | Must be kept for non-admin staff until the self-service Leave page (EmpLeave, another area) takes over. Deep links `?tab=my` ×7, `?tab=apply` ×3 exist in code (search, dashboard, notifications) |

**Deep links that must keep working.**
- Frontend: `/hrms/leave?tab=approvals` (12 references), `?tab=my` (7), `?tab=apply` (3), `?tab=encash` (2), `?tab=history` (1), `?tab=holidays` (1).
- Backend: notification route `ROUTE_ENCASH = "/hrms/leave?tab=encash"` in `DomainEventListener.java`. `GlobalSearchService` returns `/hrms/leave?tab=my`.

**Backend endpoints and permissions (quoted `@PreAuthorize`).**

`LeaveController`, `/v1/leave`:
- `POST /apply`: `hasAuthority('leave.request.self')`. Always the caller's own employee id; there is no "for someone else".
- `GET /overview`, `/my`, `/my/balances`: `hasAuthority('leave.balance.read')`.
- `POST /{id}/cancel`: `leave.request.self`.
- `GET /approvals/pending`, `/approvals/history`, `POST /{id}/decision`, `POST /{id}/l1-decision`: `@perm.check('hrms.leave.approve.l1')`.
  - Holders of `hrms.leave.approve.l2` get the whole tenant. Others get their broadened team scope.
  - The decisions also call `approverScopeGuard.assertCanDecideFor(...)`.
- `GET /approvals/pending-l2`, `POST /{id}/l2-decision`: `@perm.check('hrms.leave.approve.l2')`.
- `POST/PUT/DELETE /types`: `hasAuthority('leave.type.write')`. `GET /types?companyId`: `isAuthenticated()`.

`EmployeeLeaveController`, `/v1/leave/employees/{id}/balances|requests`:
- `hasAnyAuthority('hrms.leave.employee.read','hrms.leave.approve.l1','leave.balance.read')`, plus `access.assertCanView(employeeId, …, ANYONE, TEAM)`.

`LeaveEncashmentController`, `/v1/leave/encashments`:
- Self endpoints: `leave.request.self`.
- HR list, options for someone, raise for someone, decision: `hrms.leave.encash.approve`.
- `/payable`: `hasAnyAuthority('hrms.leave.encash.approve','payroll.runs.manage')`.

`LeaveYearEndController`:
- `/accrual/run`, `/year-end/preview`, `/year-end/carry-forward`: `hrms.leave.yearend.run`.
- `/ledger`: `hasAnyAuthority('hrms.leave.yearend.run','hrms.report.leave')`.
- `/my/ledger`: `leave.balance.read`.

`SettingsController`, `/v1/settings/holidays`:
- `GET ?companyId&year | &from&to`: `isAuthenticated()`.
- `POST`, `DELETE /{id}`: `hasAuthority('settings.holidays.write')`.
- **No PUT (edit).**

WFH (`useWfh.ts`):
- `GET /v1/wfh/pending-approvals` and the decision endpoints are used only by `Leave.tsx` Approvals. This is **the only place in the web app where WFH is decided.**

Reports:
- `GET /v1/reports/leave-balance?companyId&year`: `@perm.check('hrms.report.leave')`.
- Per-employee, per-type rows. Only `employment_status = 'ACTIVE'`, one company at a time, not paged.

**Who holds what** (from the migrations):
- `hrms.leave.employee.read`: OWNER, SUPER_ADMIN, ADMIN, HR_MANAGER (V143_13).
- `hrms.leave.encash.approve` and `hrms.leave.yearend.run`: OWNER, SUPER_ADMIN, ADMIN, HR_MANAGER (V143_23).
- FINANCE_LEAD lost `hrms.leave.approve.l1/l2` (V066) but keeps all `hrms.report.*`.
- DEPT_MANAGER has `hrms.leave.approve.l1` and `wfh.approve`, but not l2.

---

### A.1 Approvals tab: `PgLeave.dc.html` (whole file)

**Current:** `Leave.tsx` → `Approvals()`, plus the page header from `ModulePage`. It exists, but it is a different layout: two stat tiles, then approval cards (ApprovalList) with a note field.

**Header**

| # | Data point (design) | Source today | Status |
|---|---|---|---|
| 1 | Headline count "N requests are waiting for your decision" | `usePendingApprovals(page, canLeave)` → `GET /v1/leave/approvals/pending` `totalElements` | exists |
| 2 | "· K have a conflict to check" | — | **missing** (no conflict detection anywhere) |
| 3 | Empty-state headline "You’re all caught up…" | pending = 0 | exists |

**Stat cards** (UtStat: icon, label, value, delta, trend, mood, note, sparkline; two of them are clickable filters)

| # | Data point | Source today | Status |
|---|---|---|---|
| 4 | Waiting for you: value | pending `totalElements` (leave). WFH has its own count | exists |
| 5 | Waiting for you: delta "N new since yesterday" | pending list pages of 20 only | **missing**. Needs a count of pending created in the last 24h, in scope |
| 6 | Approved in {month}: value | — | **missing**. History has no status or month filter and no counts |
| 7 | Approved in {month}: delta % vs last month | — | **missing** |
| 8 | Approved: 7-month sparkline | — | **missing** |
| 9 | On leave today: value | `useTeamDashboard()` → `GET /v1/attendance/dashboard` `counts.onLeave` needs `attendance.team.read` | **partial**. It is attendance-based and gated by a different permission. There is no leave-based "approved leave covering today" count |
| 10 | On leave today: delta "N more on {next working day}" | — | **missing** (no date-range leave query) |
| 11 | Average approval time: value (hours) | data is in `leave_requests.created_at` / `decision_at` | **missing** endpoint |
| 12 | Average approval time: delta vs last month | — | **missing** |
| 13 | Average approval time: sparkline | — | **missing** |

**Requests card**

| # | Data point | Source today | Status |
|---|---|---|---|
| 14 | Segment count: Pending | pending `totalElements` | exists |
| 15 | Segment count: Approved | — | **missing** (history has no status filter or counts) |
| 16 | Segment count: Rejected | — | **missing** |
| 17 | Segment count: All | pending + history `totalElements` | partial. History also includes CANCELLED, and PENDING_L2 is in neither list (see risk R9) |
| 18 | Row: initials avatar | `employeeName` (enriched by `LeaveController.enrichPage`) | exists |
| 19 | Row: name | `employeeName` | exists |
| 20 | Row: department | `departmentName` (enriched) | exists |
| 21 | Row: "applied {relative time}" | `createdAt` | exists |
| 22 | Row: leave type label | `leaveTypeName` | exists |
| 23 | Row: type colour (Casual / Earned / Sick / Comp-off tints) | no code or category on `LeaveRequestResponse` | partial. Join `useLeaveTypes(companyId)` on the client, or enrich `leaveTypeCode`/`category` on the server. Colour by category, not by name |
| 24 | Row: dates | `startDate`/`endDate` | exists |
| 25 | Row: days / "Half day" | `totalDays` (0.5 = half day). `duration` is stored but not in the response | exists (derive "Half day" from 0.5) |
| 26 | Row: reason (quoted) | `reason` | exists |
| 27 | Row: "x of y left after this" | `GET /v1/leave/employees/{id}/balances` per row (N+1). `available` already nets out the pending request | partial. Should be enriched on the pending response |
| 28 | Row: conflict warning (team overlap, notice period…) | — | **missing**. Note: the design's "Will be unpaid (loss of pay)" can't happen here, because apply refuses when the balance is short (`INSUFFICIENT_LEAVE_BALANCE`). "Overlaps the campaign launch" needs company events that don't exist |
| 29 | Decided row: status pill | `status` (5 values incl. PENDING_L2 "Awaiting HR") | exists |
| 30 | Decided row: "by You · 20 Sep" (who) | `approver_id` is overwritten with the decider in `approveLeave`, but no name is returned | **missing** (enrich `decidedByName`) |
| 31 | Decided row: when | `approvedAt` (= `decision_at`) | exists |

**Who's off next week card**

| # | Data point | Source today | Status |
|---|---|---|---|
| 32 | People off per working day (avatars, names), approved + pending | — | **partial**. The only approved source is `useLeaveCalendarTeam` (walks `/approvals/history`, max 10×100 rows, APPROVED only). Pending rows come from the first page of `/approvals/pending`. There is no date-range endpoint |
| 33 | "{n} off · +{m} more" | as #32 | partial |
| 34 | Holiday row ("Gandhi Jayanti · holiday") | `GET /v1/settings/holidays?companyId&from&to` (supported by `SettingsController.listHolidays`) | exists (one company). Weekends from `useWeekendDays(companyId)` |

**Leave used this year card**

| # | Data point | Source today | Status |
|---|---|---|---|
| 35 | Per leave type: days used and days granted, company-wide, as bars | `GET /v1/reports/leave-balance` (`hrms.report.leave`), summed on the client | **partial**. Different permission, ACTIVE employees only (probation and notice excluded), one company at a time, no aggregate endpoint |

**Actions**

| # | Action | API today | Status | Gate today |
|---|---|---|---|---|
| a1 | Leave calendar (header button) | navigates to `?tab=calendar` | exists | page access |
| a2 | Policies (header button) | should open `/hrms/master/leave-rules` (Master → Rules & policies → Leave rules) | exists (link only) | registry `m-leave-rules`: `any('leave.type.write','hrms.policy.write')` |
| a3 | **Apply on behalf** (primary) | — (`POST /v1/leave/apply` always uses the JWT's own employee id) | **missing** | new permission needed |
| a4 | Stat card as filter (Waiting → Pending, Approved → Approved) | client state | exists (UI only) | — |
| a5 | On leave today → opens calendar | navigation | exists | — |
| a6 | Segments Pending / Approved / Rejected / All | pending + history. Needs a `status` filter on history | partial | `hrms.leave.approve.l1` |
| a7 | Approve (row) | `useLeaveDecision` → `POST /v1/leave/{id}/decision` `{status:'APPROVED', comment}` | exists | `@perm.check('hrms.leave.approve.l1')` + approverScopeGuard |
| a8 | Reject (row) | same, `REJECTED` | exists | same |
| a9 | Approve all without conflicts | — | **missing** (needs conflicts, #28, and a bulk decision) | l1 |
| a10 | Undo after approve/reject (README, DECISIONS §3) | — | **missing** (no revert-to-pending endpoint) | l1 |
| a11 | Open requester's profile (row click) | `/hrms/employees/:id` | exists | route `anyOf [HRMS_EMPLOYEE_READ, ATTENDANCE_TEAM_READ]` |
| a12 | *Kept, not in design:* decision note (textarea on each card today) | `comment` on the decision | exists | l1 |
| a13 | *Kept, not in design:* WFH requests in the same queue, WFH approve/reject (reject needs a note: `WFH_REJECT_REASON_REQUIRED`) | `useWfhDecision` | exists | `P.WFH_APPROVE` |
| a14 | *Kept:* pagination (20 per page) | `HrPagination` | exists | — |

**Shared components needed:** PageHeader (eyebrow, title, headline, actions), StatCard ×4 (sparkline, delta, active/clickable), Card/Section, SegmentedControl with counts, ApprovalRow (avatar, type chip, facts, reason, balance line, conflict line, Approve/Reject, Undo, decided pill + "by"), StatusPill, Avatar + avatar stack, Meter/ProgressBar (brand and gold), EmptyState, Skeleton, Toast, Dialog (reject note), SidePanel + FormField + Dropdown with search (Apply on behalf).

**Page-specific pieces:** the "Who's off next week" day list, and the leave-type tint map by category.

---

### A.2 Decided tab: `PgTime.dc.html` `P['l-ops'].tabs[1]`

**Current:** `Leave.tsx` → `Decided()` (RowList). It exists.

| # | Data point | Source | Status |
|---|---|---|---|
| 1 | Employee name · department | `/approvals/history` enriched | exists |
| 2 | Leave type | `leaveTypeName` | exists |
| 3 | Dates · days | `startDate`, `endDate`, `totalDays` | exists |
| 4 | Decided by | — | **missing** (enrich from `approver_id`; L2 from `l2_approver_id`) |
| 5 | Result pill | `status` | exists |
| 6 | Segment All / Approved / Rejected (filter) | — | partial. The client can filter a page of 20. There is no server `status` param, so counts and pages are wrong |
| 7 | Title and sub "Requests you or other approvers have already decided." | copy | — |
| 8 | *Kept:* approver note / reason line | `approverComment`, `reason` | exists |

**Actions:**
- Segment filter: partial.
- Pagination: exists.
- Header "Apply for someone": **missing** (same as A.1 a3).

**Gate:** `hrms.leave.approve.l1`. Scope: tenant-wide for `hrms.leave.approve.l2` holders, personal for managers (`LeaveController.approvalsHistory`).

**Shared:** table section (UtSection "table": avatar first cell with a sub line, StatusPill, segmented filter), EmptyState ("No decisions yet"), Skeleton.

---

### A.3 Balances tab: `PgTime.dc.html` `P['l-ops'].tabs[2]`

**Current:** nothing company-wide on the Leave page. Today's `balances` tab is the signed-in person's own balances (`Leave.tsx` `Balances()`, `useMyBalances` → `GET /v1/leave/my/balances`, plus `useMyLeaveLedger`). The company-wide figures exist only in Reports → Leave balance (`/hrms/reports/leave-balance`, `useLeaveBalanceReport`).

| # | Data point | Source | Status |
|---|---|---|---|
| 1 | Employee name · department | `GET /v1/reports/leave-balance` (`employee_name`, `department`) | partial (report permission, ACTIVE only, one company) |
| 2 | One column per leave type: "available / total" | same report: `available`, `total_entitlement` (+`carry_forward`) | partial |
| 3 | Comp-off column (a number) | a COMPENSATORY-category type shows like any type | partial (comp-off is not modelled; see A.7) |
| 4 | Sub "What each person has left, after pending requests." | `available` already subtracts pending | exists |

**Actions:**
- Header "Apply for someone": **missing**.
- Needed but not drawn: search, company picker, paging.

**Gate proposal:** `hrms.leave.employee.read` (OWNER, SUPER_ADMIN, ADMIN, HR_MANAGER) or `hrms.report.leave` (adds FINANCE_LEAD), like `/v1/leave/ledger` already does.

**Shared:** table section, SearchPill/input, Dropdown (company), EmptyState ("No leave balances yet"), Skeleton, pagination.

---

### A.4 Calendar tab: `PgTime.dc.html` `P['l-ops'].tabs[3]`

**Current:** `leave/LeaveCalendar.tsx` + `leave/useLeaveCalendar.ts`. It exists, as "{Month} — Who's away?", with Prev/Today/Next, weekend shading, today ring, chips and a monthly list.

| # | Data point | Source | Status |
|---|---|---|---|
| 1 | Month title | client | exists |
| 2 | Day tags "{first name} · {type code}" | `useLeaveCalendarTeam` (walks `/approvals/history`, APPROVED) + `useLeaveCalendarSelf` (`/my`) | partial. Only the first 1,000 decided requests. Type **code** isn't in the response (name only) |
| 3 | "+N more" | client | exists |
| 4 | Holiday tags on the grid | `useHolidays` exists but isn't used here | partial (data exists, not shown) |
| 5 | Weekends | `useWeekendDays` + `jsWeekendDays` | exists |
| 6 | Today marker | client | exists |
| 7 | *Kept:* "Away in {month}" list, truncation note, scope sentence for non-approvers | — | exists |

**Actions:**
- Prev/Today/Next: exists.
- Header "Apply for someone": **missing**.

**Gate:** team data needs `hrms.leave.approve.l1`. Your own data needs `leave.balance.read`. With neither, the tab shows a lock state.

**Rule:** the grid must be built on `src/shared/components/calendar` (its `dateMath`, `CalChip`/`CalArrow`, like `design/dc/DashCalendar`). Today's `LeaveCalendar` uses date-fns and its own grid.

**Shared:** MonthCalendar (day states + legend), CalChip/CalArrow, StatusPill tones for tags, EmptyState, Skeleton, error state with Retry.

---

### A.5 Encash tab: `PgTime.dc.html` `P['l-ops'].tabs[4]`

**Current:** `leave/LeaveEncashment.tsx`. `EncashmentAdmin` is shown with `hrms.leave.encash.approve`. `MyEncashment` is shown for your own encashment (`leave.request.self`, not admins). It exists.

| # | Data point | Source | Status |
|---|---|---|---|
| 1 | "Can encash now: N days · across encashable leave types" (company-wide) | only per person: `GET /encashments/my/options`, `/options/{employeeId}` | **missing** (no company-wide sum) |
| 2 | Waiting for HR (count) | `useEncashments('PENDING')` | exists |
| 3 | Approved, to be paid (count; today it also shows the amount) | `useEncashments('DECIDED')` filtered APPROVED | exists |
| 4 | Row: employee | `employeeName`/`employeeCode` | exists |
| 5 | Row: leave type | `leaveTypeName` | exists |
| 6 | Row: days | `days` | exists |
| 7 | Row: amount | `amount` (null until priced) | exists |
| 8 | Row: status pill | `status` | exists |

**Actions:**

| Action | API | Status |
|---|---|---|
| Approve | `POST /v1/leave/encashments/{id}/decision {approved:true}` | exists |
| Reject | same, `approved:false` | exists |
| *Kept:* raise encashment for an employee | `POST /encashments/for/{employeeId}` | exists |
| *Kept:* own request | `POST /encashments` | exists |
| *Kept:* own cancel | `POST /encashments/{id}/cancel` | exists |
| *Kept:* decided list | — | exists |

**Gate:** `hrms.leave.encash.approve` for the HR half. `leave.request.self` and `!isAdmin` for your own.

**Shared:** stats section (small stat tiles), table section with row actions, ApprovalRow, SidePanel (raise for someone), Dropdown with search (employee), FormField.

---

### A.6 Year end tab: `PgTime.dc.html` `P['l-ops'].tabs[5]`

**Current:** `leave/LeaveYearEnd.tsx`. It exists.

| # | Data point | Source | Status |
|---|---|---|---|
| 1 | Monthly/quarterly credit per type ("1 day a month", "2 days a quarter") | `useLeaveTypes(companyId)` `accrualFrequency` + `annualEntitlement` | exists (derive the rate) |
| 2 | Next credit date | client (1st of next month or quarter; the job runs 00:30 IST) | exists (derive) |
| 3 | Carried forward (days) | `useCarryForwardPreview(year)` → `GET /v1/leave/year-end/preview` `totalCarried` | exists |
| 4 | Its leave-type note ("Earned leave") | preview `lines` grouped by type | exists (derive) |
| 5 | Lapses (days) + type note | `totalLapsed`, lines | exists |
| 6 | Above the caps: people count | lines with `lapsed > 0`, distinct people | exists (derive) |

**Actions (kept; not drawn in the design):**
- Credit now: `POST /v1/leave/accrual/run`.
- Year picker.
- Run carry forward, with a confirm: `POST /v1/leave/year-end/carry-forward?fromYear`.
- Preview list.
- Audit trail: `GET /v1/leave/ledger?limit=100`.

All exist.

**Gate:** `hrms.leave.yearend.run` (the ledger also accepts `hrms.report.leave`).

**Shared:** kv section (Facts), stats section, Dialog (confirm), ListRow, StatusPill.

---

### A.7 Leave types tab: `PgTime.dc.html` `P['l-ops'].tabs[6]`

**Current:** `leave/LeaveTypes.tsx` (`embedded`). It exists as a DataTable and a right-hand drawer. The same component is also used by `Policies.tsx`.

| # | Data point | Source (`GET /v1/leave/types?companyId`) | Status |
|---|---|---|---|
| 1 | Name · code | `name`, `code` | exists |
| 2 | Days a year | `annualEntitlement` | exists. **"As earned"** (comp-off) is missing |
| 3 | Carry forward ("No" / "Up to 30 days") | `isCarryForwardAllowed`, `maxCarryForwardDays` | exists. **"Expires in 90 days"** (comp-off expiry) is missing |
| 4 | Encashable (Yes/No) | `isEncashable` | exists |
| 5 | Status pill | `isActive` | exists |
| 6 | Count in heading | list length | exists |

**Actions:**

| Action | API | Status |
|---|---|---|
| Add leave type | `POST /v1/leave/types?companyId` | exists |
| Edit | `PUT /v1/leave/types/{id}`. Nulls keep the accrual and encash fields, so there is no wipe risk | exists |
| Deactivate | `DELETE /v1/leave/types/{id}` (today behind `window.confirm`) | exists |
| *Kept:* Seed defaults | loops the create call | exists |

**Gate:** read with `isAuthenticated()`. Writes need `leave.type.write` (`<Can code={P.LEAVE_TYPE_WRITE}>`, `usePermission`). Accrual and encash settings stay on Master → Leave rules.

**Company:** today it uses `companies[0]` unless a company is passed in.

**Shared:** table section with row actions, StatusPill, SidePanel + FormField (toggle, number), Dialog (deactivate confirm, replacing `window.confirm`), EmptyState.

---

### A.8 Holidays tab: `PgTime.dc.html` `P['l-ops'].tabs[7]`

**Current:** `leave/HolidayCalendar.tsx` (`embedded`, `canEdit = SETTINGS_HOLIDAYS_WRITE`). It exists.

| # | Data point | Source (`useHolidays(companyId, year)` → `GET /v1/settings/holidays`) | Status |
|---|---|---|---|
| 1 | Count "{n}" in heading | list length | exists |
| 2 | Holiday name | `holidayName` | exists |
| 3 | Date | `holidayDate` | exists |
| 4 | Day of week | derive | exists |
| 5 | **Applies to** (All branches / Pune) | — (`settings.holiday_calendar` has only `company_id`) | **missing** |
| 6 | Type (Public / Optional) | `holidayType`, 6 values (NATIONAL, FESTIVAL, RESTRICTED, REGIONAL, OPTIONAL, COMPANY) | exists (map the labels; keep all 6) |
| 7 | Year (sub "for 2026") | year picker state | exists |

**Actions:**

| Action | API | Status |
|---|---|---|
| Add Holiday | `POST /v1/settings/holidays` | exists |
| Delete (today via `window.confirm`) | `DELETE /v1/settings/holidays/{id}` (archives) | exists |
| **Edit** | — (no PUT) | **missing** |
| Year picker | — | exists (kept) |
| Company choice | — (uses `companies[0]`) | missing (frontend only) |

**Gate:** read `isAuthenticated()`, write `settings.holidays.write`.

**Shared:** table section, StatusPill, SidePanel + FormField (DateField from the shared calendar), Dialog (delete confirm), Dropdown (year, company), EmptyState.

---

### A.9 Tabs that exist today and are not in this design (keep)

| Tab | Content | Shown to | Note |
|---|---|---|---|
| My leave | Your requests (`useMyLeaves`), balance tiles, Cancel with a dialog (`useCancelLeave`) | `!isAdmin` | |
| Apply | Leave form (`useApplyLeave` → `POST /v1/leave/apply?companyId`) with weekend-aware preview, overlap/balance/past-date/reason checks | `!isAdmin` | |
| Balances (own) | Balance cards + ledger (`useMyLeaveLedger`) | `!isAdmin` | |

The self-service redesign (`EmpLeave.dc.html`) covers these for employees. See conflicts D.1–D.3.

---

## B. Payroll run (`/hrms/payroll/runs`, `/hrms/payroll/runs/:id`)

### B.0 Page, routes, navigation and permissions today

**Routes (`App.tsx`).**
- `/hrms/payroll/runs`: `RequirePermission code={P.PAYROLL_RUNS_READ}` + `RouteGuard anyOf={[P.PAYROLL_RUNS_READ]}` + `ModuleGate moduleKey="payroll"` → `PayrollContainer`.
- `/hrms/payroll/runs/:id`: `RouteGuard anyOf={[P.PAYROLL_RUNS_READ]}` + `ModuleGate payroll`.

**Query strings in use.**
- `?month=YYYY-MM` on the list (from the dashboard chart).
- `?tab=overview|employees|skipped` on a run.
- Related links: `/hrms/bank-disbursement?run=` and `/hrms/salary-structure?employee=`.

**Files.**
- Container: `modules/hrms/payroll/PayrollContainer.tsx`. The section comes from the path.
- Logic: `design/dc/PayrollModule.tsx` (section bar "Payroll sections"), `PayRuns.tsx` (list), `NewRunModal.tsx`, `PayrollRunPage.tsx` (one run), `PayrollOverview.tsx`, `PayrollEmployees.tsx`, `PayslipDrawer.tsx`, `ProcessSteps.tsx`.
- Views: the matching `*.view.tsx` files are **generated** by `scripts/design-build.mjs` from the old export `docs/Designs/UnifiedTree HRMS Prototype.html`.
- Hooks: `modules/hrms/api/usePayrollRuns.ts`, `useDisbursement.ts`, `useAdvance.ts`.

**Pages exist: yes.** All runs, and a run page with in-page tabs Overview / Employees (badge) / Skipped (badge, only when someone was skipped).

**Rail and menu.**
- Group `payroll-hr` → "Processing & Payslips" `/hrms/payroll/runs`.
- The rule comes from the registry `page('pay-runs', …, [{ ...any('payroll.runs.read'), module: PAY }])`.
- `PlatformShell` `OWN_SECTION_BAR` hides the shell sub-nav on these paths because the payroll page draws its own section bar.

**Design tabs (`M.payroll` page `py-runs`) and their mapping.**

| Design tab | Route |
|---|---|
| All runs | `/hrms/payroll/runs` |
| Overview | `/hrms/payroll/runs/:id` (`?tab=overview`) |
| Employees | `/hrms/payroll/runs/:id?tab=employees` |
| Skipped | `/hrms/payroll/runs/:id?tab=skipped` |

The three run tabs need a "current run" to open when you are on All runs (see Q9).

**Backend (`PayrollRunController`, `/v1/payroll`; quoted `@PreAuthorize`).**

| Endpoint | Permission |
|---|---|
| `GET /runs`, `/runs/{id}`, `/runs/{id}/eligible-employees`, `/runs/{id}/employees`, `/runs/{id}/skipped`, `/runs/{id}/component-totals`, `/statutory-dues`, `/runs/{id}/employees/{empId}/payslip`, `…/payslip.pdf` | `hasAuthority('payroll.runs.read')` |
| `POST /runs`, `/runs/{id}/process` | `hasAuthority('payroll.runs.manage')` |
| `POST /runs/{id}/lock`, `/runs/{id}/reopen` | `hasAuthority('payroll.runs.lock')` |
| `GET /v1/payroll/reports/salary-register?runId` | `payroll.runs.read`. **LOCKED/PAID runs only** (`RUN_NOT_LOCKED`) |
| `GET /v1/payroll/disbursement/batches[/{id}]` | `hrms.disbursement.read` |
| `POST batches`, `/{id}/post`, `GET /{id}/file` | `hrms.disbursement.build` |
| `POST /{id}/mark-paid`, `/{id}/cancel` | `hrms.disbursement.post` |
| Bank profiles | `hrms.bank_profile.read` |
| `GET /v1/payroll/dashboard/kpis`, `/trend` | `payroll.runs.read` |

**Frontend gates (`PayrollContainer`).**
- `canRuns = usePermission(P.PAYROLL_RUNS_READ)`, `canManage = …RUNS_MANAGE`, `canLock = …RUNS_LOCK`.
- `canDisbRead` (`hrms.disbursement.read`), `canBuild` (`hrms.disbursement.build`), `canPost` (`hrms.disbursement.post`), `canProfiles` (`hrms.bank_profile.read`).
- `canAdvRead` (`hrms.advance.read`), `canEmpRead` (`hrms.employee.read`). The employee directory is used for department and joining date.
- `canStruct` (`payroll.structure.read`).

**Data model notes.**
- Payroll tables are JDBC-only (no JPA entity maps `payroll.*`).
- Payroll does **not** calculate TDS (`PayrollCalc` has no tax logic). TDS appears only if a fixed "TDS" component is configured.
- Payroll does **not** pay overtime. It **does** pay approved PLI awards and leave encashment as earnings.

---

### B.1 All runs tab: `PgPay.dc.html` `P['py-runs'].tabs[0]`

**Current:** `design/dc/PayRuns.tsx` (+ view) through `PayrollContainer` section `runs` with no id. It exists.

| # | Data point | Source (`useRuns()` → `GET /v1/payroll/runs`) | Status |
|---|---|---|---|
| 1 | Stage counts Draft / Processed / Locked / Paid | client count of `status` | exists |
| 2 | Processed note "Sep 2026 · waiting for review" | runs | exists |
| 3 | Paid note "This financial year" | company `fiscalYearStart` (`useCompanies`) | exists (derive) |
| 4 | Row: period + company ("Sep 2026 · Demo Technologies") | `periodMonth/Year`, `companyName` | exists |
| 5 | Row: pay date | `payDate` (V143.11; null on older runs → dash) | exists |
| 6 | Row: employees | `employeeCount` | exists |
| 7 | Row: gross | `totalGross` | exists |
| 8 | Row: deductions | `totalDeductions` | exists |
| 9 | Row: net pay | `totalNet` | exists |
| 10 | Row: status pill | `status` (5 values incl. CANCELLED) | exists |
| 11 | Count in heading | list length | exists |
| 12 | Segments All runs / Processed / Paid | client | exists |
| 13 | *Kept:* exceptions ("N exceptions · Review" → `?tab=skipped`), "Processed" date, next-step hint, Cancelled aside | `skippedEmployeeCount`, `processedAt` | exists |

**Actions:**

| Action | API | Status | Gate |
|---|---|---|---|
| "Open {month} run" (primary) | navigation to the current run | exists (frontend: choose the run) | `payroll.runs.read` |
| Row "Open run" | navigation | exists | same |
| Row "Register" (paid rows) | `GET /v1/payroll/reports/salary-register?runId` (PDF) | exists | same |
| *Kept:* **New run** (not drawn in the design) | `NewRunModal` → `POST /v1/payroll/runs` | exists | `payroll.runs.manage` |
| *Kept:* filters company / year / month / status, clear | client | exists | — |

**Shared:** stats section (stage tiles as filters), table section (plain), SegmentedControl/FilterPills, Dropdown filters, StatusPill, EmptyState ("No payroll runs · Add salary structures…"), Skeleton, Dialog (New run).

---

### B.2 Overview tab: `PgPayroll.dc.html` (whole file)

**Current:** `design/dc/PayrollRunPage.tsx` (header, ProcessSteps, 4 stat tiles, tabs) + `PayrollOverview.tsx` (pay breakdown, "Before you process / Included in this run" checks, run details, bank file, activity log). It exists, with a different layout.

| # | Data point | Source | Status |
|---|---|---|---|
| 1 | Title "{Month Year} pay run" | `useRun(id)` → `GET /v1/payroll/runs/{id}` | exists |
| 2 | Pay period | `periodStart/End` | exists |
| 3 | Pay date | `payDate` | exists |
| 4 | Employee count | `employeeCount` (draft: `useEligibleEmployees` length) | exists |
| 5 | "across N branches" | — | **missing** (the run employee rows have no branch; the directory has `branchId`) |
| 6 | Step title + sub per state | `status` + bank batch | exists |
| 7 | Draft meta "Created {date} · {name}" | `createdAt`, `createdByName` | exists |
| 8 | Processed meta "{date} · N payslips" | `processedAt`, `employeeCount` | exists |
| 9 | Locked meta "Not yet · N flags open" | `lockedAt` | partial (the flag count needs B-checks) |
| 10 | Paid meta ("Bank file after lock" / paid date) | batches (`?runId`) `paidAt` | exists |
| 11 | Bank name in "upload it to {bank}" | bank profile `profileName` | exists (`hrms.bank_profile.read`) |
| 12 | Gross pay value | `totalGross` | exists |
| 13 | Gross delta vs previous month + 7-month sparkline | previous runs of the same company from `useRuns()` | exists (derive on the client) |
| 14 | Deductions value | `totalDeductions` | exists |
| 15 | Deductions delta | runs | exists (derive) |
| 16 | Deductions note "PF, PT, TDS" | `component-totals` DEDUCTION lines | partial (TDS only if configured) |
| 17 | Net payable value | `totalNet` | exists |
| 18 | Net delta + sparkline | runs | exists (derive) |
| 19 | "to N bank accounts" | `employeeCount`. The true account count is only known after the bank file (`beneficiaryCount`) | partial |
| 20 | Employer cost value "incl. PF and ESI" | gross + `EMPLOYER_CONTRIBUTION` lines from `GET /runs/{id}/component-totals` | exists (derive) |
| 21 | Employer cost delta | needs the previous run's employer contributions (one more component-totals call, or a field on RunDto) | partial |
| 22 | Employee pay: name | `useRunEmployees` → `GET /runs/{id}/employees` | exists |
| 23 | Employee pay: sub line (department, or a note like "Sales incentive ₹…", "14 h overtime", "4 days loss of pay", "Full & final in progress", "New joiner · prorated") | department via the directory (`hrms.employee.read` only). LOP from `lopDays`. Nothing else | partial / **missing** (overtime isn't paid; FnF and incentive notes aren't on the row) |
| 24 | Paid days "X / Y" | `paidDays` (+ period days) | exists |
| 25 | LOP / "Joined {date}" note | `lopDays`. Joining date via the directory | partial |
| 26 | Gross | `gross` | exists |
| 27 | Deductions | `deductions` (returned by the API, dropped by the container) | exists (API) |
| 28 | Net pay | `netPay` | exists |
| 29 | vs previous month % ("New" when not in the last run) | — | **missing** |
| 30 | Status Ready / Review / On hold | — | **missing** (no review flags; no hold feature) |
| 31 | Segment counts All / Needs review / On hold | — | partial (All) / **missing** |
| 32 | "Checks before you lock" list + count: >10% change from last month; missing bank details; new joiners prorated; full & final on hold | today's checks: attendance/LOP, PLI, advance recoveries, salary structures/skipped | partial. The design's four checks are **missing** |
| 33 | "Where the money goes": gross by component (donut + legend) | `component-totals` EARNING/REIMBURSEMENT | exists |
| 34 | Donut sub "Gross pay ₹… by component" | `totalGross` | exists |
| 35 | Statutory dues from this run: PF, ESI, PT, TDS amounts | `component-totals` (PF_EMPLOYEE+PF_EMPLOYER, ESI_EMPLOYEE+ESI_EMPLOYER, PT, LWF_*, TDS if configured). `GET /statutory-dues` only covers locked/paid runs and is per month | partial |
| 36 | Statutory due dates | PF/ESI: 15th of next month (in `/statutory-dues`). TDS: 7th of next month (not in the API). PT: state-dependent | partial |
| 37 | "3D coins" art (UtArt image slot) | no asset in the handoff | **missing** (and see D.14) |

**Actions**

| # | Action | API | Status | Gate |
|---|---|---|---|---|
| p1 | Preview payslips | `GET /runs/{id}/employees/{empId}/payslip` (+ `.pdf`) | exists | `payroll.runs.read` |
| p2 | Export register | `GET /v1/payroll/reports/salary-register` (LOCKED/PAID only). For processed runs the Employees tab exports CSV on the client | partial | `payroll.runs.read` |
| p3 | Primary by state: Process / **Lock run** / **Mark as paid** | `POST /runs/{id}/process` · `POST /runs/{id}/lock` · batch `POST /{id}/post` then `POST /{id}/mark-paid {paymentReference}` (a bank file and a UTR are required) | exists | manage · lock · `hrms.disbursement.post` (+ build for post) |
| p4 | *Kept:* Re-process | `POST /runs/{id}/process` | exists | `payroll.runs.manage` |
| p5 | *Kept:* Reopen for corrections (reason ≥ 5 chars; cancels a live bank file first) | batch cancel + `POST /runs/{id}/reopen {reason}` | exists | `payroll.runs.lock` (+ `hrms.disbursement.post` for the cancel) |
| p6 | *Kept:* Prepare bank disbursement | `POST /v1/payroll/disbursement/batches {runId, bankProfileId}` | exists | `hrms.disbursement.build` |
| p7 | *Kept:* View bank disbursement, Download bank file | navigation, `GET /batches/{id}/file` | exists | build |
| p8 | Segment All / Needs review / On hold | — | **missing** | read |
| p9 | Row click → profile (design) or payslip (today) | navigation / payslip | exists | read (profile route needs `hrms.employee.read` or `attendance.team.read`) |
| p10 | "See all N" → Employees tab | navigation | exists | read |
| p11 | Check CTAs Review / Fix now / View / Open | navigation targets exist (Employees filter, `/hrms/employees/:id?tab=payroll`, `/hrms/fnf`) | partial (check data missing) | read |
| p12 | Hold / release a payslip (implied by "On hold") | — | **missing** | new |

**Existing button-vs-permission mismatch** (`PayrollRunPage.tsx`). Today these flags draw two buttons each:
- `aProcessed = step==='processed' && (perm.manage || perm.lock)` draws **Re-process and Lock** together.
- `aLocked = … && (perm.lock || perm.build)` draws Reopen and Prepare.
- `aReady = … && (perm.lock || perm.post)` draws Reopen and Mark as paid.

So a custom role with only one of those codes sees a button that answers 403. The redesign should gate each button by its own code.

**Shared components:** PageHeader, Stepper card (ProcessSteps restyled), StatCard ×4 with sparkline and delta, Card/Section, SegmentedControl, table/ListRow with Avatar, StatusPill, count pill, checks ListRow (dot + text + CTA), Donut/Ring with legend, key/value ListRow (statutory), Dialog (process / lock / reopen / prepare / paid), FormField (reason, UTR), SidePanel (payslip), EmptyState, Skeleton, Toast.

---

### B.3 Employees tab (+ payslip view): `PgPay.dc.html` `P['py-runs'].tabs[2]` and `V.slip`

**Current:** `design/dc/PayrollEmployees.tsx` and `PayslipDrawer.tsx`. They exist.

| # | Data point | Source | Status |
|---|---|---|---|
| 1 | Count "Payslips (N)" | `useRunEmployees` length | exists |
| 2 | Sub "{Month} run · N payslips. Preview until the run is locked." | run | exists |
| 3 | Row: name · code | `employeeName`, `employeeCode` | exists |
| 4 | Row: paid days | `paidDays` | exists |
| 5 | Row: gross | `gross` | exists |
| 6 | Row: deductions | `deductions` (API has it; the container drops it) | exists (API) |
| 7 | Row: net pay | `netPay` | exists |
| 8 | Row: status (Ready / Needs review / On hold) | — | **missing** |
| 9 | Segments Everyone / Needs review / On hold | — | **missing** (Everyone exists) |
| 10 | Slip: title "Payslip · {name}" | `useRunPayslip` → `GET /runs/{id}/employees/{empId}/payslip` | exists |
| 11 | Slip: period · code · department | `period`, `employeeCode`, `department` (V143.11) | exists |
| 12 | Slip: preview/final note | `runStatus` | exists |
| 13 | Slip: paid days + LOP note | `paidDays`, `lopDays`, `totalDays` | exists |
| 14 | Slip: gross earnings | `gross` | exists |
| 15 | Slip: total deductions ("PF, PT and recoveries") | `totalDeductions` | exists |
| 16 | Slip: net pay + "Credited on {pay date}" | `netPay`, run `payDate` | exists |
| 17 | Slip: earnings lines | `earnings[]` | exists |
| 18 | Slip: deductions lines | `deductions[]` | exists |
| 19 | Slip: "Income tax (TDS) · Not calculated yet" | static copy (payroll has no TDS) | exists (as copy) |
| 20 | *Kept:* LOP column, department filter, search, CSV export, pagination, PAN/bank masked, amount in words | directory, `panMasked`, `bankMasked` | exists |

**Actions:**

| Action | API | Status |
|---|---|---|
| Segment filter | — | **missing** (needs row status) |
| Payslip (open) | payslip GET | exists |
| Download preview | `GET …/payslip.pdf` (works for any status) | exists |
| Back | — | exists |
| *Kept:* search | — | exists |
| *Kept:* department filter | (via directory, `hrms.employee.read`) | exists |
| *Kept:* Export CSV | — | exists |
| *Kept:* pagination | — | exists |

**Gate:** `payroll.runs.read`.

**Shared:** table section, SegmentedControl, StatusPill, SidePanel (payslip, square), Ledger block (earnings/deductions/net), StatCard (small), EmptyState ("Payslips appear here once the run is processed"), Skeleton, error state with Retry ("Couldn’t load this payslip").

---

### B.4 Skipped tab: `PgPay.dc.html` `P['py-runs'].tabs[3]`

**Current:** the skipped tab inside `PayrollRunPage.tsx`, plus the banner. It exists. Today the tab is hidden when nobody was skipped.

| # | Data point | Source | Status |
|---|---|---|---|
| 1 | Count | `useRunSkipped` → `GET /runs/{id}/skipped` | exists |
| 2 | Employee name · code | `employeeName`, `employeeCode` | exists |
| 3 | Department | directory (`hrms.employee.read`) | partial (blank without that permission) |
| 4 | Joined | directory `dateOfJoining` | partial (same) |
| 5 | Why ("No salary structure") | fixed reason of the endpoint | exists |
| 6 | *Kept:* "Structure added" state | `GET /v1/payroll/structures/employee/{id}` per skipped person (`payroll.structure.read`) | exists |
| 7 | "What happens next" (before / after lock copy) | copy by `status` | exists |

**Actions:**
- Add structure → `/hrms/salary-structure?employee={id}`: exists (the page needs `payroll.runs.read`; saving needs `payroll.structure.manage`).

**Shared:** table section, StatusPill, kv section, EmptyState ("Everyone is included").

---

## C. Gaps: backend work each missing piece needs

These follow the rules in DECISIONS.md:
- No JPA-mapped column changes. New tables and columns are read and written with JdbcTemplate only.
- Every new permission is granted to OWNER and SUPER_ADMIN (plus the listed roles) in its migration.
- Every new feature degrades to a hidden or empty block until production has applied the migration.

"JPA" means the table is mapped by a JPA entity:
- `leave_mgmt.leave_requests`, `leave_types`, `leave_balances`, `wfh_requests` and `settings.holiday_calendar` are JPA.
- `payroll.*` and `leave_mgmt.leave_encashment_requests` are JDBC-only.

### Leave

| ID | What | Backend work | Schema | JPA table touched | Size |
|---|---|---|---|---|---|
| L1 | Approval stats (Waiting + new since 24h, Approved this month + 7-month series + delta, On leave today / next working day, Average approval time + series) | `GET /v1/leave/approvals/stats?months=7` in LeaveController + LeaveService (read queries over `created_at`, `decision_at`, `status`, dates). Scope like `/approvals/pending`: l2 → tenant, else the broadened manager match. `@perm.check('hrms.leave.approve.l1')`. Unit tests | no | reads leave_requests (JPA) | M |
| L2 | Pending/decided row enrichment: leave type code + category, half-day, requester balance (available / total), conflicts (same-department overlap with approved or pending leave; requester on notice period), `decidedByName` | Extend `LeaveRequestResponse` with **additive** fields. Every `new LeaveRequestResponse(...)` must be updated: `LeaveController.enrich`, `LeaveRequestMapperImpl` (checked in), `LeaveService`, tests. Batch queries per page (no N+1). No permission change | no | reads leave_requests, leave_balances, leave_types, hrms.employees | M |
| L3 | Date-range leave feed (Calendar, Who's off next week, On leave today) | `GET /v1/leave/calendar?from&to&statuses=APPROVED,PENDING,PENDING_L2`. l2 → tenant, l1 → team (broadened match), `leave.balance.read` → self. Add a `(tenant_id, start_date, end_date)` index in a migration (index only). Replaces the 10-page history walk in `useLeaveCalendar.ts` | index only | leave_requests | M |
| L4 | Decided tab: server-side status filter + per-status counts | `status` param on `/approvals/history` (+ counts, or fold into L1). Name enrichment is in L2 | no | leave_requests | S |
| L5 | PENDING_L2 ("Awaiting HR") invisible on the web admin queue (`findAllPending` = `status='PENDING'` only). The single-step `/decision` refuses non-PENDING | Include PENDING_L2 rows for `hrms.leave.approve.l2` holders and decide them via `/l2-decision` (existing endpoint) | no | — | S |
| L6 | Approve all without conflicts | `POST /v1/leave/approvals/bulk-decision {ids, status, comment}` → per-id result. Reuses `approveLeave` + `approverScopeGuard` per id. l1 | no | — | S |
| L7 | Undo a decision (leave and WFH) | `POST /v1/leave/{id}/undo` and `/v1/wfh/{id}/undo`. Only the decider, inside a window, before the leave starts, and not inside a LOCKED/PAID payroll period. Restore PENDING, reverse the balance (approved: used−, pending+; rejected: pending+), notify the employee. Optional JDBC audit table `leave_mgmt.decision_undos` | optional new table | leave_requests, leave_balances, wfh_requests (JPA; no column change) | M |
| L8 | Apply on behalf ("Apply on behalf" / "Apply for someone") | `POST /v1/leave/apply/for/{employeeId}`: same validation and approver chain as `/apply`. Record who raised it (the JPA-audited `created_by` already stores the auditor; or a JDBC table `leave_mgmt.leave_request_raised_by`). New permission `hrms.leave.apply.others` in a migration, granted to OWNER, SUPER_ADMIN, ADMIN, HR_MANAGER (+ COMPANY_ADMIN?), following the V143_24 advance-on-behalf pattern. Notify the employee. The frontend hides the button without the permission | permission rows (+ optional new table) | leave_requests | M |
| L9 | Everyone's balances (design Balances tab) | `GET /v1/leave/balances?companyId&year&page&size&q`: every non-exited employee (not only ACTIVE), per type available / total / used / pending / carry. `hasAnyAuthority('hrms.leave.employee.read','hrms.report.leave')` | no | leave_balances | S |
| L10 | Leave used this year (company-wide, per type) | `GET /v1/leave/usage?year&companyId` (sum used; sum entitlement + carry per type). Same permission as L9 (can be one endpoint) | no | leave_balances | S |
| L11 | Encash summary "Can encash now N days" | `GET /v1/leave/encashments/summary` (`hrms.leave.encash.approve`) over encashable types | no | leave_encashment_requests (JDBC), leave_balances | S |
| L12 | Holidays "Applies to" branches | New JDBC table `settings.holiday_branches(holiday_id, branch_id)` (the `holiday_calendar` table is JPA-mapped, so no column). Accept `branchIds` on create and update. Leave day counting (`LeaveService.fetchHolidayDates`), the attendance policy and payroll working days must respect branch scope. Degrade to "All branches" until migrated | **new table** | holiday_calendar (JPA; untouched) | L |
| L13 | Holiday edit | `PUT /v1/settings/holidays/{id}` (`settings.holidays.write`) | no | holiday_calendar (JPA fields only) | S |
| L14 | Comp-off "As earned" / "Expires in N days" | Comp-off credits from work on weekly offs or holidays, plus an expiry job. New JDBC tables (the old `leave_mgmt.comp_off_balances` is unused and unmapped). Leave type needs an expiry setting (not a JPA column → side table) | **new tables** | leave_types (JPA; untouched) | L |

Frontend-only leave items:
- A company picker for Leave types, Holidays, Year end and Calendar (today `companies[0]`) (S).
- The type tint by category.
- The new Balances tab key.

### Payroll run

| ID | What | Backend work | Schema | JPA | Size |
|---|---|---|---|---|---|
| P1 | Run employee rows: department, branch, designation, joining date, previous-run gross/net and % change, "new" flag, has-bank-account, FnF in progress | Extend `RunEmployeeDto` **additively** (`PayrollRunService.listRunEmployees`). Previous run = same company, previous period, via `payroll.payslip_lines`. Joins `hrms.employees`, `hrms.employee_bank_accounts` (primary, active), `fnf_mgmt.fnf_settlements`. `payroll.runs.read`. Removes the dependency on the directory (`hrms.employee.read`) for department and joining date | no | none (JDBC) | M |
| P2 | "Checks before you lock" (variance > 10%, missing bank details, prorated new joiners, FnF in progress, skipped, LOP) + "N flags open" | `GET /v1/payroll/runs/{id}/checks` → `[{key, severity, count, text, employeeIds}]` (reuses the P1 queries) | no | none | M |
| P3 | Statutory dues from this run, with due dates | `GET /v1/payroll/runs/{id}/statutory` (PF ee+er, ESI ee+er, PT, LWF, TDS if a TDS line exists; due dates PF/ESI 15th, TDS 7th of next month, PT per state or null) | no | none | S |
| P4 | Employer cost on the run + trend | Add `employerContributions` (sum of `EMPLOYER_CONTRIBUTION` lines) to `RunDto` (additive), so deltas and sparklines come from `GET /runs` | no | none | S |
| P5 | "On hold" payslips (status, segment, "Full & final … is on hold") | New JDBC table `payroll.payslip_holds(run_id, employee_id, reason, held_by, held_at, released_by, released_at)`. `POST /runs/{id}/employees/{empId}/hold` and `…/release` (`payroll.runs.manage` or a new code granted to OWNER and SUPER_ADMIN). The bank-file builder (`DisbursementBatchService`) must leave held people out. Graceful until migrated | **new table** | none | L |
| P6 | "Export register" before lock | Allow PROCESSING in `PayrollReportService.salaryRegister` with a "Draft — figures can change" watermark, or keep the CSV until lock | no | none | S |
| P7 | TDS in deductions and statutory dues | Income-tax engine (regimes, declarations, slabs, monthly projection) | new tables | none | L (only if wanted) |
| P8 | Overtime pay ("Overtime" slice, "14 h overtime") | Approved overtime → an earnings line at processing | maybe | none | L (only if wanted) |
| P9 | "across N branches" in the header | From P1 (branch per row) | no | none | S |

Frontend-only payroll items:
- The "current run" choice for the Overview/Employees/Skipped pill tabs.
- Pass `deductions` through to the Employees table.
- Gate each run-page button by its own permission (see B.2).

---

## D. Conflicts with existing behaviour and earlier client decisions

1. **Tab key "balances".** Design Balances = everyone's balances. Today `?tab=balances` = your own balances. The registry entry `leave:balances` is "Leave balances" (self, hidden for admin roles). Suggestion:
   - Keep `balances` meaning "mine" for deep links.
   - Give the HR tab a new key (e.g. `people-balances`) and gate it by `hrms.leave.employee.read` or `hrms.report.leave`.
2. **One route, two designs.** `/hrms/leave` serves both the admin ops layout (PgLeave + PgTime `l-ops`) and employees (the EmpLeave design is another agent's area). HR_MANAGER, DEPT_MANAGER and FINANCE_LEAD both apply for their own leave and use ops tabs today. The layout must be chosen by permission, keeping `?tab=my|apply|balances` working (search, dashboard "Apply leave", notifications, `live-dead-entrypoints.mjs`).
3. **Admin-role rule.** OWNER, SUPER_ADMIN, COMPANY_ADMIN and ADMIN don't get My leave / Apply / own Balances (client rule; `access.ts` `adminRole`, `Leave.tsx` `!isAdmin`). Keep it. It is the same spirit as "My Attendance hidden for OWNER/ADMIN/SUPER_ADMIN". The design's "HR admin" persona also covers HR and finance, but those roles are not in the admin bucket and keep their self tabs.
4. **WFH approvals.** Leave → Approvals is the only place in the web app where WFH is decided (`usePendingWfhApprovals` is used only here and as a dashboard count). The design's list is leave-only. Keep WFH rows (type chip "Work from home") and the rule that a WFH rejection needs a note.
5. **Decision note.** Today every card has a note textarea, and `live-design-leave.mjs` fills it. The design rows have no note. Keep an optional note (for example Reject opens a small Dialog asking for the reason; Approve has an optional note).
6. **Calendar component rule.** The client rule is that calendars use `src/shared/components/calendar`. Today's `LeaveCalendar.tsx` uses date-fns and its own grid, so rebuild it as the shared MonthCalendar. Moving the data to L3 changes the page-walk behaviour that `live-leave-calendar.mjs` asserts.
7. **Settings stay in their own sections.** Accrual frequency, encashable and max encash days are edited on Master → Leave rules (`/hrms/master/leave-rules`). The design's "Policies" button should link there, not embed it. Holidays are only managed on Leave → Holidays today (no Settings section), so they stay.
8. **Branch holidays (L12)** change how many days a leave request costs, and change attendance and payroll working days, for branch-scoped holidays. This is a behaviour change, not just UI.
9. **Payroll section bar → shell.** `PayrollModule`'s "Payroll sections" bar and `PlatformShell` `OWN_SECTION_BAR` are replaced by the shell's Pages button plus pill tabs. The run page's in-page tabs (HrTabs) become the top-bar pills All runs / Overview / Employees / Skipped. `PayrollRunPage` reads `?tab=` only on mount (`componentDidMount`), so it must follow URL changes.
10. **"New run" isn't drawn** on All runs (the design's primary is "Open {month} run"). Keep New run for `payroll.runs.manage` (no feature removal).
11. **Mark as paid** needs a prepared bank file and a UTR (API: `mark-paid` is on the disbursement batch). Keep the Prepare step and the UTR dialog between Lock and Paid. The design's "Bank file ready · upload it to HDFC…" copy already assumes this.
12. **Register before lock** is refused by the API (`RUN_NOT_LOCKED`). For a processed run, "Export register" must use the CSV export, or P6 is needed.
13. **TDS.** Payroll calculates none. Don't show a TDS due or "PF, PT, TDS" unless a TDS line exists. The payslip keeps "Income tax (TDS) · Not calculated yet" (asserted by `live-design-payroll.mjs` in the salary drawer).
14. **Imagery.** PgPayroll's `UtArt` "3D coins" slot has no asset, and the README says "No other imagery". Drop it or use an icon.
15. **Rupee visibility.** The `PlatformShell` comment says "only admin/finance see rupees" (`R_FIN_RUPEE`). But menus are permission-only now, and HR_MANAGER holds `payroll.runs.read` ("see everyone's salary"), so HR sees all run amounts today and in the design. Keep this permission-driven. There is no role-based hiding in the run pages today.
16. **Toast wording.** Tests assert "Leave approved", "Leave request sent", "Leave cancelled", "Payroll processed · N payslips", "Payroll locked · payslips are final" and "Payroll reopened". The design's toasts use other words ("Approved Priya’s casual leave · …"). Keep the existing leading words or update the tests.
17. **Left-rail highlight (`src/layouts/railLit.ts`).** `/hrms/leave` belongs to both the `leave` and the `ess` rail items. `litRailKey` keeps the item the person came through. The redesign must keep this, and `live-rail-highlight.mjs` reads the lit view through `[role=group][aria-label="Leave views"] button[aria-pressed="true"]` and the title "Leave Management".
18. **Multi-company.** Leave types, holidays, year end and weekend days use `companies[0]` today. Payroll runs are per company. The design's "company-wide" figures and "the {month} run" need a company scope.

---

## E. Shared components needed (README list) and page-specific pieces

- **Both pages:** PageHeader, PillTabs (top bar), Card/Section, StatCard (sparkline, delta, active/clickable), StatusPill (ok / warn / bad / mint / info / gray), SegmentedControl with counts, ListRow / table row with Avatar, EmptyState, Skeleton, Toast, Dialog, SidePanel (square, stepper not needed), FormField (input, select, textarea, toggle, number), Dropdown with search (employee picker), FilterPills.
- **Leave only:** ApprovalRow (inline approve/reject + Undo + decided state), MonthCalendar (on `src/shared/components/calendar`), Meter/ProgressBar, avatar stack. The PgTime "UtSections" pattern (stats / table / kv / cal section kinds) should become a small shared section renderer for Decided, Balances, Calendar, Encash, Year end, Leave types and Holidays.
- **Payroll only:** Stepper (ProcessSteps restyled), Donut/Ring with legend ("Where the money goes"), checks row (dot, text, CTA), key/value dues rows, Ledger (earnings / deductions / net) for the payslip SidePanel.
- **Must be replaced by shared pieces** (rule: every modal, drawer and confirm):
  - HolidayCalendar `AddHolidayDrawer` (a `div.ut-card` drawer).
  - LeaveTypes `TypeDrawer`.
  - The `window.confirm` in holiday delete and type deactivate.
  - `@unifiedtree/ui-kit` `Modal` in Leave cancel and carry-forward confirm.
  - `HrDrawer`.
  - The payroll `Modal` dialogs and the `PayslipDrawer`.

---

## F. Risks

1. **Live tests that assert today's markup** (they will need updating together with the pages):

   `e2e/recovery/live-design-leave.mjs`:
   - "Leave views" navigation, and view names My leave / Apply / Balances / Calendar / Leave types / Holidays.
   - Buttons "Apply for leave", "Choose a leave type", "Send request", and "Cancel" with the "Cancel leave" dialog.
   - Labels "From *" / "To *" and the placeholder "At least 10 characters".
   - `/^2 days of leave/`.
   - An `article` approval card with a `textarea` and an "Approve" button.
   - Toasts /Leave request sent/, /Leave approved/, /Leave cancelled/.

   `e2e/recovery/live-leave-calendar.mjs`:
   - Heading "{Month} — Who's away?", `[data-date]` cells, "Today" and "Weekend" labels.
   - Prev / Next / Today buttons.
   - List "Approved leave this month" and "No one is on approved leave this month".
   - "Couldn't load the leave calendar" + Retry.
   - The truncation note and the **10-page history walk** count.
   - The employee scope sentence.

   `e2e/recovery/live-rail-highlight.mjs`:
   - `[role=group][aria-label="Leave views"] button[aria-pressed="true"]` and the rail title "Leave Management".

   `e2e/recovery/live-w3-r2.mjs`:
   - Leave From/To comboboxes.
   - Holidays: a native `select` year picker, "Add Holiday", the drawer `div.ut-card` with `h3` "Add Holiday", `.utc-field` combobox, placeholder "e.g. Republic Day", `.ut-card-sm` row + delete button through `window.confirm`.

   `e2e/recovery/live-dead-entrypoints.mjs`:
   - "Apply leave" → `/hrms/leave?tab=apply`.

   `e2e/recovery/live-w3-search.mjs`:
   - `/hrms/leave?tab=my`, and the page title "Processing & Payslips".

   `e2e/recovery/live-design-payroll.mjs`:
   - Nav "Payroll sections"; heading "Processing & Payslips" (exact).
   - "New run" and the dialog year combobox, "^Jun", "Create run", heading "Jun 2027", "Draft".
   - "^Process$" + dialog "Process payroll"; toast "Payroll processed · N payslips".
   - Tab "Employees", `tbody tr`, "Payslip", drawer "Preview" + "Rupees … only".
   - "^Lock$" + "Lock run"; "Reopen for corrections" + "Reopen payroll" (disabled until a reason), placeholder /Wrong LOP/.
   - "Download payroll register", "Download PDF", and the salary drawer "Income tax (TDS) … Not calculated yet".
   - **This test creates, processes, locks and reopens a Jun 2027 run in the local DB.** It must never run against production.

   `e2e/recovery/live-payroll-access.mjs`:
   - "Reopen for corrections", the dialog textarea, "Reopen payroll", "^Process$".
   - Tab "^Employees", "Payslip", "Unable to load this payslip. It may no longer be available for this run.", "Try again", "Couldn’t load this payroll run".
   - It also processes, pays and reopens a real local run and cleans up.

   API-only tests are unaffected if DTO changes are additive: `live-w1b.mjs`, `live-w1f.mjs`, `live-w1g.mjs` (page label "Processing & Payslips").

   Older Playwright specs `e2e/tests/{super-admin,hr-manager,dept-manager,employee,finance-lead}/*leave*|*payroll*`: they already use selectors that no longer exist ("Select leave type", `input[type=date]`, "confirm approve", heading /payroll runs/), so they are probably failing today. Check before blaming the redesign.

   `e2e/live/role-matrix.spec.ts` (Leave tab labels per role), `anil-verification.spec.ts` (Add Type / Add Holiday open as a right-hand drawer), and smoke / pages-sweep / prod-sweep (route loads).

   Unit tests:
   - `src/shared/navigation/pageRegistry.test.ts`: leave tab param, `leave:apply` hidden for admins, `/hrms/payroll/runs` menu locked or hidden.
   - `src/layouts/railLit.test.ts`: `/hrms/leave` in `leave` + `ess`.
   - `src/shared/search/search.test.ts`: `/leave/approvals` → `/hrms/leave?tab=approvals`.
   - Backend `GlobalSearchServiceTest` (`/hrms/leave?tab=my`).

2. **Generated views.** `scripts/design-build.mjs` regenerates `PayRuns`, `PayrollRunPage`, `PayrollOverview`, `PayrollEmployees`, `PayslipDrawer`, `PayrollModule`, `NewRunModal` and `ProcessSteps` views (with PATCHES) from the old export. If these are rebuilt by hand, retire their build entries, or a later run of the script silently restores the old markup.
3. **Record DTOs.**
   - `LeaveRequestResponse` is a positional Java record. It is built in `LeaveController.enrich`, `LeaveService` and the checked-in `LeaveRequestMapperImpl`, and is consumed by the mobile app.
   - `RunDto` and `RunEmployeeDto` are likewise records.
   - Only add fields. Never rename or remove.
4. **Production migrations are applied by hand.**
   - L7 (optional table), L8 (permission), L12, L14, P5 (tables) and the L3 index must degrade quietly: hide the button or show "All branches" until applied.
   - New permissions must include OWNER and SUPER_ADMIN, or `OwnerPermissionInvariantCheck` stops the app booting.
5. **Undo (L7)** interacts with notifications already sent and with payroll. Leave affects attendance ON_LEAVE (computed live) and so LOP. Refuse undo inside a LOCKED/PAID payroll period.
6. **Branch holidays (L12)** touch leave counting, attendance and payroll working days. This is high regression risk and needs tests on all three.
7. **Counts vs lists.** A stats endpoint (L1) that counts PENDING_L2 while the queue list (without L5) doesn't show it would disagree. Define both on the same statuses.
8. **Payroll pages are money pages.** A mis-gated button means a 403 at best, and at worst the wrong action shown to finance. Gate each action by its own permission.
9. **No live verification was possible** (API and DB were down during this audit). The data-point statuses are from code. Re-check the endpoints live in Phase 1.

---

## G. Open questions (only the real ones)

1. **Apply leave on behalf:**
   - When HR applies for an employee, should it follow the normal approval chain, or be approved at once?
   - Which roles get the new permission? My proposal is OWNER, SUPER_ADMIN, ADMIN and HR_MANAGER; COMPANY_ADMIN is undecided.
2. **"On hold" payslips:** build a real hold/release (a new table; held people left out of the bank file), or drop "On hold" from the design?
3. **Undo window for leave and WFH decisions:** how long? Options: a few minutes, until the leave starts, or until payroll for that month is locked.
4. **Holidays "Applies to":** build branch-specific holidays (this changes leave day counts and attendance for those branches), or keep holidays company-wide and show "All branches"?
5. **Comp-off:** build "earned by working a weekly off or holiday, expires after N days", or keep comp-off as an ordinary leave type?
6. **TDS and overtime in the pay run:** build an income-tax engine and overtime pay, or show only what payroll calculates today (no TDS or overtime lines)?
7. **Register before lock:** allow a draft PDF register (watermarked) for processed runs, or keep only the CSV until lock?
8. **Self tabs for HR_MANAGER, DEPT_MANAGER and FINANCE_LEAD:** keep My leave / Apply / own Balances on `/hrms/leave` next to the ops tabs, or send their own leave only to the self-service Leave page? Today's `?tab=my|apply|balances` links would then need redirects.
9. **Which run the Overview / Employees / Skipped tabs open** when a tenant has several companies with a run in the same month. My proposal: this month's run of the company last chosen, else the latest non-cancelled run.
